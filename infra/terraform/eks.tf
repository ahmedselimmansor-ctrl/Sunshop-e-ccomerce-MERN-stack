# ─────────────────────────────────────────────────────────────────────────────
# EKS cluster.
#
# Nodes run in private subnets; the API server endpoint is public but
# CIDR-restricted, so kubectl works from the office and CI without exposing the
# control plane to the internet at large.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_eks_cluster" "main" {
  name     = local.name
  version  = var.eks_version
  role_arn = aws_iam_role.eks_cluster.arn

  vpc_config {
    subnet_ids              = concat(aws_subnet.private[*].id, aws_subnet.public[*].id)
    endpoint_private_access = true
    endpoint_public_access  = true
    public_access_cidrs     = var.eks_public_access_cidrs
    security_group_ids      = [aws_security_group.eks_cluster.id]
  }

  # Envelope encryption for Kubernetes Secrets with a customer-managed key.
  # Without this, a Secret is only base64 in etcd.
  encryption_config {
    provider {
      key_arn = aws_kms_key.eks.arn
    }
    resources = ["secrets"]
  }

  enabled_cluster_log_types = ["api", "audit", "authenticator", "controllerManager", "scheduler"]

  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = false
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
    aws_cloudwatch_log_group.eks,
  ]
}

resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${local.name}/cluster"
  retention_in_days = 90
  kms_key_id        = aws_kms_key.logs.arn
}

# OIDC provider: the foundation of IRSA. Without it, pods would need static
# AWS credentials mounted as secrets.
data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
}

resource "aws_eks_node_group" "general" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${local.name}-general"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = var.node_instance_types
  capacity_type  = "ON_DEMAND"
  ami_type       = "AL2023_ARM_64_STANDARD"
  disk_size      = 50

  scaling_config {
    desired_size = 3
    min_size     = 3
    max_size     = 12
  }

  update_config {
    # One node at a time during an AMI upgrade; the PDB then guarantees the API
    # never drops below two replicas.
    max_unavailable = 1
  }

  labels = {
    workload = "general"
  }

  lifecycle {
    # The cluster autoscaler owns desired_size after creation.
    ignore_changes = [scaling_config[0].desired_size]
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_worker_node,
    aws_iam_role_policy_attachment.eks_cni,
    aws_iam_role_policy_attachment.ecr_read_only,
  ]

  tags = {
    "k8s.io/cluster-autoscaler/enabled"       = "true"
    "k8s.io/cluster-autoscaler/${local.name}" = "owned"
  }
}

# Spot capacity for interruption-tolerant work (reindex jobs, batch), tainted
# so nothing lands there by accident.
resource "aws_eks_node_group" "spot" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${local.name}-spot"
  node_role_arn   = aws_iam_role.eks_nodes.arn
  subnet_ids      = aws_subnet.private[*].id

  instance_types = ["t4g.large", "t4g.xlarge", "m7g.large"]
  capacity_type  = "SPOT"
  ami_type       = "AL2023_ARM_64_STANDARD"

  scaling_config {
    desired_size = 0
    min_size     = 0
    max_size     = 10
  }

  taint {
    key    = "workload"
    value  = "batch"
    effect = "NO_SCHEDULE"
  }

  labels = { workload = "batch" }

  lifecycle {
    ignore_changes = [scaling_config[0].desired_size]
  }
}

# Managed add-ons, pinned so an upgrade is a deliberate commit.
resource "aws_eks_addon" "vpc_cni" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "vpc-cni"
  resolve_conflicts_on_update = "PRESERVE"
  service_account_role_arn    = aws_iam_role.vpc_cni.arn
}

resource "aws_eks_addon" "coredns" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "coredns"
  resolve_conflicts_on_update = "PRESERVE"
  depends_on                  = [aws_eks_node_group.general]
}

resource "aws_eks_addon" "kube_proxy" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "kube-proxy"
  resolve_conflicts_on_update = "PRESERVE"
}

resource "aws_eks_addon" "ebs_csi" {
  cluster_name                = aws_eks_cluster.main.name
  addon_name                  = "aws-ebs-csi-driver"
  resolve_conflicts_on_update = "PRESERVE"
  service_account_role_arn    = aws_iam_role.ebs_csi.arn
}

variable "eks_public_access_cidrs" {
  description = "CIDRs allowed to reach the Kubernetes API. Never 0.0.0.0/0 in production."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
