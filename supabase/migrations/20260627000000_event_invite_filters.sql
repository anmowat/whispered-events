-- Add invite targeting filters to events.
-- invite_employment: employment types to invite (e.g. Employed, Fractional, Founder).
-- invite_company_size: company sizes to invite (e.g. 1-50, 51-200, 201-1000, 1000+).
-- Both default to empty = no filter (invite everyone). Matching logic will use
-- these in a future phase; for now they are admin + host editable metadata only.
alter table events
  add column if not exists invite_employment text[] not null default '{}',
  add column if not exists invite_company_size text[] not null default '{}';
