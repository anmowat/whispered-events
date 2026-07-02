-- Drop the invite_ prefix from the three event targeting columns.
-- Rename: invite_employment → employment, invite_company_size → company_size,
--         invite_seniority → seniority.
--
-- Also fixes company_size taxonomy: switches from headcount buckets
-- (1-50, 51-200, 201-1000, 1000+) to the revenue buckets used on user
-- profiles (<$5M, $5-25M, $25-100M, $100M-1B, $1B+, Other) so the two
-- can actually be compared during matching.

alter table events rename column invite_employment   to employment;
alter table events rename column invite_company_size to company_size;
alter table events rename column invite_seniority    to seniority;

-- Update the column default for company_size to the revenue taxonomy.
alter table events
  alter column company_size set default
    array['<$5M','$5-25M','$25-100M','$100M-1B','$1B+','Other'];

-- Reset rows that still carry headcount defaults (or empty) to the revenue defaults.
update events
set company_size = array['<$5M','$5-25M','$25-100M','$100M-1B','$1B+','Other']
where company_size @> array['1-50','51-200','201-1000','1000+']
   or company_size = '{}';
