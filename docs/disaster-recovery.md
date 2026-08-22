# Disaster recovery

## Targets

| Scenario                   | RPO      | RTO                          |
| -------------------------- | -------- | ---------------------------- |
| Single pod failure         | 0        | < 30s (automatic)            |
| Availability-zone loss     | 0        | < 2 min (automatic)          |
| DocumentDB primary failure | 0        | < 2 min (automatic failover) |
| Accidental data deletion   | ≤ 5 min  | < 1 hour                     |
| Full region loss           | ≤ 1 hour | 4-8 hours (manual)           |

These are targets, not guarantees. Only the first three are exercised automatically;
the last two depend on a restore that has to be **rehearsed quarterly** or the numbers
are fiction.

---

## What is backed up

| Data            | Mechanism                                    | Retention                        |
| --------------- | -------------------------------------------- | -------------------------------- |
| DocumentDB      | Automated snapshots + continuous PITR        | 30 days                          |
| ElastiCache     | Daily snapshot                               | 7 days                           |
| S3 media        | Versioning + cross-region replication        | 90 days for non-current versions |
| Elasticsearch   | **Not backed up**: rebuilt from MongoDB      | n/a                              |
| Audit log       | Streamed to S3 with Object Lock (COMPLIANCE) | 400 days, immutable              |
| Terraform state | S3 versioning + DynamoDB locking             | Indefinite                       |
| Secrets         | Secrets Manager, 30-day recovery window      | 30 days after deletion           |

**Elasticsearch is deliberately not backed up.** It is a derived index; MongoDB is the
source of truth. Restoring a stale search index is worse than rebuilding a correct one,
and a full reindex takes minutes.

**Redis is only lightly protected.** Cache entries are disposable. The consequence of
losing Redis is that every user is signed out: recoverable, and the daily snapshot
exists mainly to shorten the cold-cache window after a restore.

---

## Point-in-time recovery

The scenario this actually addresses: a bad migration or a mistaken bulk operation at
14:32, noticed at 14:47.

```bash
# 1. Stop writes. Maintenance mode blocks the storefront for everyone but staff.
kubectl -n sunshop exec deploy/sunshop-api -- \
  redis-cli -u "$REDIS_URL" SET sunshop:flags:maintenance 1

# 2. Restore to a moment before the damage, into a NEW cluster.
#    Never restore over the running one: if the timestamp is wrong you have
#    destroyed the only remaining copy of the good data.
aws docdb restore-db-cluster-to-point-in-time \
  --db-cluster-identifier sunshop-production-docdb-restored \
  --source-db-cluster-identifier sunshop-production-docdb \
  --restore-to-time 2026-08-22T14:30:00Z \
  --db-subnet-group-name sunshop-production-docdb \
  --vpc-security-group-ids sg-xxxxxxxx

aws docdb create-db-instance \
  --db-instance-identifier sunshop-production-docdb-restored-0 \
  --db-cluster-identifier sunshop-production-docdb-restored \
  --db-instance-class db.r6g.large \
  --engine docdb

# 3. Verify against the restored cluster before cutting over.
mongosh "mongodb://sunshop:PASSWORD@<restored-endpoint>:27017/sunshop?tls=true" \
  --eval 'db.orders.countDocuments({}); db.products.countDocuments({})'

# 4. Cut over by updating the secret, then restart.
aws secretsmanager put-secret-value \
  --secret-id sunshop/production/docdb \
  --secret-string "$(jq -c '.uri = "mongodb://...restored..."' <<< "$CURRENT")"

kubectl -n sunshop annotate externalsecret sunshop-api-secrets force-sync=$(date +%s) --overwrite
kubectl -n sunshop rollout restart deployment/sunshop-api

# 5. Rebuild the search index, which now reflects a different point in time.
kubectl -n sunshop create job --from=cronjob/sunshop-reindex-nightly reindex-after-restore

# 6. Lift maintenance mode.
kubectl -n sunshop exec deploy/sunshop-api -- redis-cli -u "$REDIS_URL" DEL sunshop:flags:maintenance
```

**Reconciliation after a PITR.** Orders placed between the restore point and the cutover
are gone from the database but exist at Stripe. Export the payment intents for that
window and replay them manually: this is the part people forget, and the customers who
were charged will notice.

```bash
stripe payment_intents list \
  --created[gte]=$(date -d '2026-08-22 14:30' +%s) \
  --limit 100
```

---

## Zone failure

Handled automatically, and worth stating so nobody intervenes unnecessarily:

- Pods are spread across three AZs with `topologySpreadConstraints`, so a zone loss
  removes at most a third of capacity and the HPA replaces it.
- DocumentDB promotes a reader in another AZ within about a minute.
- ElastiCache fails over with `automatic_failover_enabled` and `multi_az_enabled`.
- Each AZ has its own NAT gateway, so egress survives.

The correct response is to watch, not to act.

---

## Region failure

Not automated. Sunshop runs single-region by design: active-active multi-region for a
transactional store means either accepting write conflicts or paying a latency penalty
on every checkout, and neither is worth it below a certain revenue.

Recovery is a rebuild, roughly 4-8 hours:

1. **Restore the data.** Copy the latest DocumentDB snapshot to the target region and
   restore it. This is the long pole and cannot be shortened without cross-region
   replication.
2. **Provision infrastructure.** `terraform apply` with `region` pointed at the target.
   The state bucket must be replicated ahead of time or this step has no state to work
   from.
3. **Restore secrets.** Secrets Manager is regional. Replicate the secrets in advance
   (`aws secretsmanager replicate-secret-to-regions`) or recreate them by hand.
4. **Deploy.** Images are already multi-region if ECR replication is on; otherwise push
   them.
5. **Reindex** search from the restored database.
6. **Repoint DNS.** Route 53 with a low TTL on the API and storefront records.

**Prerequisites that must exist _before_ an incident**, or the plan does not work:

- [ ] Terraform state bucket replicated cross-region
- [ ] ECR cross-region replication enabled
- [ ] Secrets Manager replicas configured
- [ ] DocumentDB snapshots copied to the DR region on a schedule
- [ ] Route 53 TTLs at 60s on `api.` and the apex

---

## Rehearsal

A restore procedure that has never been run is a document, not a plan.

**Quarterly:**

- Restore a DocumentDB snapshot into a scratch cluster and run the verification queries.
  Record how long it actually took, and update the RTO table with the real number.
- Run a full reindex against staging and time it.

**Annually:**

- Full region rebuild into a scratch account, timed end to end.
- Rotate every secret and confirm the application recovers.

**Continuously:**

- CI restores the previous night's staging snapshot before each deploy, which means the
  restore path is exercised daily whether anyone thinks about it or not.

---

## What is _not_ covered

Stated plainly:

- **No cross-region read replica.** RPO for a region loss is the snapshot age, up to an
  hour: not the five minutes that PITR gives within a region.
- **No tested Redis restore.** Sessions are treated as disposable; the assumption is
  that everyone signs in again.
- **No automated failover of DNS.** Repointing Route 53 is a human decision, because an
  automatic regional failover triggered by a monitoring blip is a worse outcome than a
  few minutes of downtime.
