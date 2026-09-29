# Permission matrix (v0.1, draft for security-owner sign-off)

Deny by default. Every role is intersected with tenant, entity and department scope. Tenant always comes from the authenticated session, never from client input.

| Action | CFO | FP&A | Controller | Accountant | Dept manager | Admin |
|---|---|---|---|---|---|---|
| View consolidated reports | scoped | scoped | scoped | no | no | no |
| View own-department spend | yes | yes | yes | no | entitled only | no |
| Run variance query | yes | yes | yes | no | entitled only | no |
| View evidence rows | scoped | scoped | scoped | no | entitled only | no |
| Define mappings / materiality | no | yes | yes | no | no | propose |
| Upload import | no | no | no | no | no | yes |
| Publish snapshot | no | no | no | no | no | yes (all gates pass) |
| Update own close task | no | no | yes | own only | no | no |
| Declare close ready | no | no | yes | no | no | no |
| Approve publication | yes | no | yes | no | no | no |
| Private scenario | yes | yes | yes | no | entitled only | no |
| Manage access / connectors | no | no | no | no | no | yes, cannot bypass approval |
| Read audit | scoped | no | scoped | no | no | yes |

Notes:
- A restricted viewer never sees a total that covers a department they cannot see (`canSeeTotal` in `packages/policy`).
- No role can write to an ERP, post entries, or send externally in the MVP.
