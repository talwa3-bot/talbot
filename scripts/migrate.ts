import { migrate } from "@ledgerlens/db";
console.log(await migrate(process.env.ADMIN_DATABASE_URL ?? "postgres://ledger_owner:owner_dev@localhost/ledgerlens"));
