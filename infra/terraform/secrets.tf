# Secrets Manager.
#
# Terraform generates the credentials and writes them here; the application
# reads them at runtime through the External Secrets Operator using its IRSA
# role. Nothing is ever copied into a ConfigMap, a CI variable or a chat
# message.

resource "random_password" "jwt_access" {
  length  = 64
  special = true
}

resource "random_password" "jwt_refresh" {
  length  = 64
  special = true
}

# AES-256 needs exactly 32 bytes; the app expects it base64-encoded.
resource "random_bytes" "field_encryption" {
  length = 32
}

resource "aws_secretsmanager_secret" "docdb" {
  name                    = "sunshop/${var.environment}/docdb"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "docdb" {
  secret_id = aws_secretsmanager_secret.docdb.id
  secret_string = jsonencode({
    username = aws_docdb_cluster.main.master_username
    password = random_password.docdb.result
    host     = aws_docdb_cluster.main.endpoint
    port     = aws_docdb_cluster.main.port
    # `retryWrites=false` is required: DocumentDB does not implement retryable
    # writes, and the driver's default would fail every write.
    uri = format(
      "mongodb://%s:%s@%s:%d/sunshop?tls=true&replicaSet=rs0&readPreference=primary&retryWrites=false",
      aws_docdb_cluster.main.master_username,
      urlencode(random_password.docdb.result),
      aws_docdb_cluster.main.endpoint,
      aws_docdb_cluster.main.port,
    )
  })
}

resource "aws_secretsmanager_secret" "redis" {
  name                    = "sunshop/${var.environment}/redis"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "redis" {
  secret_id = aws_secretsmanager_secret.redis.id
  secret_string = jsonencode({
    # `rediss://`, TLS is enforced on the replication group.
    url = format(
      "rediss://:%s@%s:6379",
      urlencode(random_password.redis.result),
      aws_elasticache_replication_group.redis.configuration_endpoint_address,
    )
    authToken = random_password.redis.result
  })
}

resource "aws_secretsmanager_secret" "jwt" {
  name                    = "sunshop/${var.environment}/jwt"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = jsonencode({
    accessSecret  = random_password.jwt_access.result
    refreshSecret = random_password.jwt_refresh.result
  })
}

resource "aws_secretsmanager_secret" "encryption" {
  name                    = "sunshop/${var.environment}/encryption"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret_version" "encryption" {
  secret_id = aws_secretsmanager_secret.encryption.id
  secret_string = jsonencode({
    fieldKey = random_bytes.field_encryption.base64
  })
}

# Provider credentials are created by hand once and then only read. Terraform
# owns the container, not the value.
resource "aws_secretsmanager_secret" "stripe" {
  name                    = "sunshop/${var.environment}/stripe"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}

resource "aws_secretsmanager_secret" "observability" {
  name                    = "sunshop/${var.environment}/observability"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "cloudfront" {
  name                    = "sunshop/${var.environment}/cloudfront"
  kms_key_id              = aws_kms_key.data.arn
  recovery_window_in_days = 30
}
