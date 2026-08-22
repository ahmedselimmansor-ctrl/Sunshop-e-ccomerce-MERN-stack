# ─────────────────────────────────────────────────────────────────────────────
# Network.
#
# Three tiers across three AZs:
#   public: the ALB and NAT gateways only
#   private. EKS nodes and pods; egress via NAT
#   isolated. DocumentDB, ElastiCache and OpenSearch, with no route to a NAT
#              at all. A compromised pod cannot exfiltrate a database dump to
#              the internet because the subnet has nowhere to send it.
# ─────────────────────────────────────────────────────────────────────────────

locals {
  name = "${var.project}-${var.environment}"

  # /20 public, /18 private (pods need a lot of IPs with the VPC CNI), /24 isolated.
  public_subnets   = [for index in range(3) : cidrsubnet(var.vpc_cidr, 4, index)]
  private_subnets  = [for index in range(3) : cidrsubnet(var.vpc_cidr, 2, index + 1)]
  isolated_subnets = [for index in range(3) : cidrsubnet(var.vpc_cidr, 8, index + 200)]
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true

  tags = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-igw" }
}

resource "aws_subnet" "public" {
  count = length(var.azs)

  vpc_id                  = aws_vpc.main.id
  cidr_block              = local.public_subnets[count.index]
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true

  tags = {
    Name                     = "${local.name}-public-${var.azs[count.index]}"
    "kubernetes.io/role/elb" = "1"
    Tier                     = "public"
  }
}

resource "aws_subnet" "private" {
  count = length(var.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.private_subnets[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name                              = "${local.name}-private-${var.azs[count.index]}"
    "kubernetes.io/role/internal-elb" = "1"
    Tier                              = "private"
  }
}

resource "aws_subnet" "isolated" {
  count = length(var.azs)

  vpc_id            = aws_vpc.main.id
  cidr_block        = local.isolated_subnets[count.index]
  availability_zone = var.azs[count.index]

  tags = {
    Name = "${local.name}-isolated-${var.azs[count.index]}"
    Tier = "isolated"
  }
}

# One NAT gateway per AZ. A single shared NAT is cheaper, but it makes an AZ
# failure take down egress for the whole cluster: and cross-AZ NAT traffic is
# billed anyway, so the saving is smaller than it looks.
resource "aws_eip" "nat" {
  count      = length(var.azs)
  domain     = "vpc"
  depends_on = [aws_internet_gateway.main]

  tags = { Name = "${local.name}-nat-${count.index}" }
}

resource "aws_nat_gateway" "main" {
  count = length(var.azs)

  allocation_id = aws_eip.nat[count.index].id
  subnet_id     = aws_subnet.public[count.index].id
  depends_on    = [aws_internet_gateway.main]

  tags = { Name = "${local.name}-nat-${var.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = { Name = "${local.name}-public" }
}

resource "aws_route_table_association" "public" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  count  = length(var.azs)
  vpc_id = aws_vpc.main.id

  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.main[count.index].id
  }

  tags = { Name = "${local.name}-private-${var.azs[count.index]}" }
}

resource "aws_route_table_association" "private" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[count.index].id
}

# Isolated subnets get a route table with no default route: deliberately.
resource "aws_route_table" "isolated" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-isolated" }
}

resource "aws_route_table_association" "isolated" {
  count          = length(var.azs)
  subnet_id      = aws_subnet.isolated[count.index].id
  route_table_id = aws_route_table.isolated.id
}

# S3 traffic (media uploads, backups) stays on the AWS network and skips the
# NAT entirely: which is both faster and materially cheaper at volume.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"

  route_table_ids = concat(
    aws_route_table.private[*].id,
    [aws_route_table.isolated.id],
  )

  tags = { Name = "${local.name}-s3-endpoint" }
}

# VPC flow logs: without them, "which pod talked to that host" is unanswerable
# after an incident.
resource "aws_flow_log" "main" {
  vpc_id               = aws_vpc.main.id
  traffic_type         = "REJECT"
  log_destination_type = "cloud-watch-logs"
  log_destination      = aws_cloudwatch_log_group.flow_logs.arn
  iam_role_arn         = aws_iam_role.flow_logs.arn
}

resource "aws_cloudwatch_log_group" "flow_logs" {
  name              = "/aws/vpc/${local.name}/flow-logs"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.logs.arn
}
