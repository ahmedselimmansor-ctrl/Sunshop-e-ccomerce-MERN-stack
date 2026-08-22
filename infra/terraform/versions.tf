terraform {
  required_version = ">= 1.9.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # State lives in S3 with DynamoDB locking. Two engineers applying at once
  # against unlocked state is how infrastructure gets silently destroyed.
  backend "s3" {
    bucket         = "sunshop-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "eu-central-1"
    dynamodb_table = "sunshop-terraform-locks"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project     = "sunshop"
      Environment = var.environment
      ManagedBy   = "terraform"
      Owner       = "platform"
    }
  }
}
