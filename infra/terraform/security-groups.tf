# Security groups.
#
# Every data-tier group accepts traffic *only* from the EKS node security group
#: referenced by id, not by CIDR, so the rule keeps holding as the cluster
# scales and IPs change.

resource "aws_security_group" "eks_cluster" {
  name        = "${local.name}-eks-cluster"
  description = "EKS control plane"
  vpc_id      = aws_vpc.main.id

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "${local.name}-eks-cluster" }
}

resource "aws_security_group" "eks_nodes" {
  name        = "${local.name}-eks-nodes"
  description = "EKS worker nodes"
  vpc_id      = aws_vpc.main.id

  tags = {
    Name                                  = "${local.name}-eks-nodes"
    "kubernetes.io/cluster/${local.name}" = "owned"
  }
}

resource "aws_vpc_security_group_ingress_rule" "nodes_self" {
  security_group_id            = aws_security_group.eks_nodes.id
  referenced_security_group_id = aws_security_group.eks_nodes.id
  ip_protocol                  = "-1"
  description                  = "Pod-to-pod traffic within the cluster"
}

resource "aws_vpc_security_group_ingress_rule" "nodes_from_control_plane" {
  security_group_id            = aws_security_group.eks_nodes.id
  referenced_security_group_id = aws_security_group.eks_cluster.id
  from_port                    = 1025
  to_port                      = 65535
  ip_protocol                  = "tcp"
  description                  = "Control plane to kubelet and pods"
}

resource "aws_vpc_security_group_egress_rule" "nodes_all" {
  security_group_id = aws_security_group.eks_nodes.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "-1"
}

resource "aws_security_group" "docdb" {
  name        = "${local.name}-docdb"
  description = "DocumentDB: reachable only from EKS nodes"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-docdb" }
}

resource "aws_vpc_security_group_ingress_rule" "docdb_from_nodes" {
  security_group_id            = aws_security_group.docdb.id
  referenced_security_group_id = aws_security_group.eks_nodes.id
  from_port                    = 27017
  to_port                      = 27017
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "redis" {
  name        = "${local.name}-redis"
  description = "ElastiCache: reachable only from EKS nodes"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-redis" }
}

resource "aws_vpc_security_group_ingress_rule" "redis_from_nodes" {
  security_group_id            = aws_security_group.redis.id
  referenced_security_group_id = aws_security_group.eks_nodes.id
  from_port                    = 6379
  to_port                      = 6379
  ip_protocol                  = "tcp"
}

resource "aws_security_group" "opensearch" {
  name        = "${local.name}-opensearch"
  description = "OpenSearch: reachable only from EKS nodes"
  vpc_id      = aws_vpc.main.id

  tags = { Name = "${local.name}-opensearch" }
}

resource "aws_vpc_security_group_ingress_rule" "opensearch_from_nodes" {
  security_group_id            = aws_security_group.opensearch.id
  referenced_security_group_id = aws_security_group.eks_nodes.id
  from_port                    = 443
  to_port                      = 443
  ip_protocol                  = "tcp"
}
