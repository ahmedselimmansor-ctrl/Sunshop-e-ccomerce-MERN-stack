variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-central-1"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["production", "staging", "dev"], var.environment)
    error_message = "environment must be one of production, staging, dev."
  }
}

variable "project" {
  type    = string
  default = "sunshop"
}

variable "vpc_cidr" {
  type    = string
  default = "10.0.0.0/16"
}

variable "azs" {
  description = "Availability zones. Three, so a single-AZ failure never costs quorum."
  type        = list(string)
  default     = ["eu-central-1a", "eu-central-1b", "eu-central-1c"]
}

variable "domain_name" {
  type    = string
  default = "sunshop.example"
}

variable "eks_version" {
  type    = string
  default = "1.31"
}

variable "node_instance_types" {
  description = "Graviton by default: ~20% better price/performance for a Node.js workload, and the images are multi-arch."
  type        = list(string)
  default     = ["t4g.large", "m7g.large"]
}

variable "docdb_instance_class" {
  type    = string
  default = "db.r6g.large"
}

variable "redis_node_type" {
  type    = string
  default = "cache.r7g.large"
}

variable "opensearch_instance_type" {
  type    = string
  default = "r7g.large.search"
}

variable "enable_deletion_protection" {
  description = "Guards the data tier against an accidental `terraform destroy`."
  type        = bool
  default     = true
}
