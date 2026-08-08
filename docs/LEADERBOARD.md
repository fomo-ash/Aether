# Community Leaderboards: Aether

## 1. Concept
The Leaderboard is a query over the `reputation_accounts` table. There is no dedicated database table for the leaderboard.

Because reputation is scoped to a Community, a user can have different reputation scores across different communities.

## 2. Database Support
The `reputation_accounts` table has an index on `[communityId, balance]` to efficiently support the underlying query:

```sql
SELECT *
FROM reputation_accounts
WHERE community_id = ?
ORDER BY balance DESC
```

## 3. UI Display
The Aether dashboard will display the Community Leaderboard with derived statistics (e.g., fulfillment rate, bets won), which can be calculated on-the-fly or cached by the API:

```text
AETHER REPUTATION

1. Ashutosh — 842
   94% fulfillment
   7 bets won

2. Anurag — 790
   91% fulfillment
   5 bets won
```
