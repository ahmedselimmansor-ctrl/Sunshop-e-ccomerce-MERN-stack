# ─────────────────────────────────────────────────────────────────────────────
# Data tier: DocumentDB, ElastiCache, OpenSearch.
#
# All three live in the isolated subnets with no route to the internet, are
# encrypted at rest with customer-managed KMS keys, and require TLS in transit.
# Credentials are generated here and written straight to Secrets Manager: they
# never appear in a variable file, and no human ever needs to see them.
# ─────────────────────────────────────────────────────────────────────────────

resource "aws_db_subnet_group" "docdb" {
  name       = "${local.name}-docdb"
  subnet_ids = aws_subnet.isolated[*].id
}

resource "random_password" "docdb" {
  length  = 40
  special = false # DocumentDB rejects several punctuation characters in passwords
}

resource "aws_docdb_cluster_parameter_group" "main" {
  family = "docdb5.0"
  name   = "${local.name}-docdb"

  parameter {
    name  = "tls"
    value = "enabled"
  }

  # Log every query slower than 100ms so a regression is visible before
  # customers report it.
  parameter {
    name  = "profiler"
    value = "enabled"
  }

  parameter {
    name  = "profiler_threshold_ms"
    value = "100"
  }
}

resource "aws_docdb_cluster" "main" {
  cluster_identifier              = "${local.name}-docdb"
  engine                          = "docdb"
  engine_version                  = "5.0.0"
  master_username                 = "sunshop"
  master_password                 = random_password.docdb.result
  db_subnet_group_name            = aws_db_subnet_group.docdb.name
  vpc_security_group_ids          = [aws_security_group.docdb.id]
  db_cluster_parameter_group_name = aws_docdb_cluster_parameter_group.main.name

  storage_encrypted = true
  kms_key_id        = aws_kms_key.data.arn

  # A month of point-in-time recovery. Restoring to "five minutes before the
  # bad migration" is the only recovery that actually helps.
  backup_retention_period      = 30
  preferred_backup_window      = "02:00-03:00"
  preferred_maintenance_window = "sun:04:00-sun:05:00"

  enabled_cloudwatch_logs_exports = ["audit", "profiler"]

  deletion_protection       = var.enable_deletion_protection
  skip_final_snapshot       = false
  final_snapshot_identifier = "${local.name}-docdb-final"

  lifecycle {
    # Rotation happens through Secrets Manager, not by editing Terraform.
    ignore_changes = [master_password]
  }
}

# One writer plus two readers, one per AZ: a failover promotes a reader without
# losing quorum or crossing a zone boundary for reads.
resource "aws_docdb_cluster_instance" "main" {
  count = 3

  identifier         = "${local.name}-docdb-${count.index}"
  cluster_identifier = aws_docdb_cluster.main.id
  instance_class     = var.docdb_instance_class
  availability_zone  = var.azs[count.index]

  enable_performance_insights = true
  auto_minor_version_upgrade  = true
}

# ── ElastiCache (Redis) ──────────────────────────────────────────────────────

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name}-redis"
  subnet_ids = aws_subnet.isolated[*].id
}

resource "random_password" "redis" {
  length  = 48
  special = false
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${local.name}-redis"
  description          = "Sunshop cache, sessions and rate limiting"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.redis_node_type
  port           = 6379

  # Two node groups, each with a replica: cache and rate-limit traffic shards
  # cleanly, and a primary failure promotes rather than empties the cache.
  num_node_groups            = 2
  replicas_per_node_group    = 1
  automatic_failover_enabled = true
  multi_az_enabled           = true

  subnet_group_name  = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
  transit_encryption_enabled = true
  auth_token                 = random_password.redis.result

  parameter_group_name = aws_elasticache_parameter_group.redis.name

  snapshot_retention_limit = 7
  snapshot_window          = "03:00-04:00"
  maintenance_window       = "sun:05:00-sun:06:00"

  auto_minor_version_upgrade = true
  apply_immediately          = false

  log_delivery_configuration {
    destination      = aws_cloudwatch_log_group.redis_slow.name
    destination_type = "cloudwatch-logs"
    log_format       = "json"
    log_type         = "slow-log"
  }

  lifecycle {
    ignore_changes = [auth_token]
  }
}

resource "aws_elasticache_parameter_group" "redis" {
  family = "redis7"
  name   = "${local.name}-redis"

  # Sessions and rate-limit buckets carry TTLs; cache entries do too. Anything
  # without one is deliberate and must not be evicted, so `volatile-lru`
  # rather than `allkeys-lru`.
  parameter {
    name  = "maxmemory-policy"
    value = "volatile-lru"
  }
}

resource "aws_cloudwatch_log_group" "redis_slow" {
  name              = "/aws/elasticache/${local.name}/slow"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn
}

# ── OpenSearch ───────────────────────────────────────────────────────────────
#
# Note: the API talks to Elasticsearch 8 via the official Elastic client, which
# refuses to connect to OpenSearch. This domain is provisioned for teams that
# prefer the managed service and are willing to swap the client for
# `@opensearch-project/opensearch`; the default deployment runs Elasticsearch on
# EKS via ECK instead. See docs/architecture.md#search.

resource "random_password" "opensearch" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}"
}

resource "aws_opensearch_domain" "search" {
  count = var.enable_managed_opensearch ? 1 : 0

  domain_name    = "${local.name}-search"
  engine_version = "OpenSearch_2.17"

  cluster_config {
    instance_type          = var.opensearch_instance_type
    instance_count         = 3
    zone_awareness_enabled = true

    zone_awareness_config {
      availability_zone_count = 3
    }

    # Dedicated masters keep cluster state stable when data nodes are busy.
    dedicated_master_enabled = true
    dedicated_master_type    = "m7g.large.search"
    dedicated_master_count   = 3
  }

  ebs_options {
    ebs_enabled = true
    volume_type = "gp3"
    volume_size = 100
    throughput  = 250
  }

  vpc_options {
    subnet_ids         = aws_subnet.isolated[*].id
    security_group_ids = [aws_security_group.opensearch.id]
  }

  encrypt_at_rest {
    enabled    = true
    kms_key_id = aws_kms_key.data.arn
  }

  node_to_node_encryption { enabled = true }

  domain_endpoint_options {
    enforce_https       = true
    tls_security_policy = "Policy-Min-TLS-1-2-PFS-2023-10"
  }

  advanced_security_options {
    enabled                        = true
    internal_user_database_enabled = true

    master_user_options {
      master_user_name     = "sunshop"
      master_user_password = random_password.opensearch.result
    }
  }

  auto_tune_options {
    desired_state = "ENABLED"
  }

  log_publishing_options {
    log_type                 = "ES_APPLICATION_LOGS"
    cloudwatch_log_group_arn = aws_cloudwatch_log_group.opensearch.arn
  }
}

resource "aws_cloudwatch_log_group" "opensearch" {
  name              = "/aws/opensearch/${local.name}"
  retention_in_days = 30
  kms_key_id        = aws_kms_key.logs.arn
}

variable "enable_managed_opensearch" {
  description = "Provision Amazon OpenSearch. Requires swapping the API's Elasticsearch client."
  type        = bool
  default     = false
}
