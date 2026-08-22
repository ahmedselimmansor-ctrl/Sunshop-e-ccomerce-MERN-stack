output "cluster_name" {
  value = aws_eks_cluster.main.name
}

output "cluster_endpoint" {
  value = aws_eks_cluster.main.endpoint
}

output "configure_kubectl" {
  description = "Run this to point kubectl at the cluster."
  value       = "aws eks update-kubeconfig --region ${var.region} --name ${aws_eks_cluster.main.name}"
}

output "api_irsa_role_arn" {
  description = "Annotate the sunshop-api ServiceAccount with this."
  value       = aws_iam_role.api.arn
}

output "media_bucket" {
  value = aws_s3_bucket.media.bucket
}

output "cdn_domain" {
  value = aws_cloudfront_distribution.media.domain_name
}

output "docdb_endpoint" {
  value     = aws_docdb_cluster.main.endpoint
  sensitive = true
}

output "redis_endpoint" {
  value     = aws_elasticache_replication_group.redis.configuration_endpoint_address
  sensitive = true
}

output "waf_acl_arn" {
  description = "Set this on the Ingress alb.ingress.kubernetes.io/wafv2-acl-arn annotation."
  value       = aws_wafv2_web_acl.main.arn
}

output "secret_arns" {
  description = "Referenced by the ExternalSecret manifests."
  value = {
    docdb      = aws_secretsmanager_secret.docdb.arn
    redis      = aws_secretsmanager_secret.redis.arn
    jwt        = aws_secretsmanager_secret.jwt.arn
    encryption = aws_secretsmanager_secret.encryption.arn
    stripe     = aws_secretsmanager_secret.stripe.arn
  }
}
