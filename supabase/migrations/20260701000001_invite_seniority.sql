alter table events
  add column if not exists invite_employment   text[] not null default '{}',
  add column if not exists invite_company_size text[] not null default '{}',
  add column if not exists invite_seniority    text[] not null default '{}';

alter table events
  alter column invite_employment   set default array['Employed','Searching','Fractional','Other'],
  alter column invite_company_size set default array['1-50','51-200','201-1000','1000+'],
  alter column invite_seniority    set default array['C-Level','VP','Director','Lead','Manager','Junior'];

update events set
  invite_employment   = array['Employed','Searching','Fractional','Other'],
  invite_company_size = array['1-50','51-200','201-1000','1000+'],
  invite_seniority    = array['C-Level','VP','Director','Lead','Manager','Junior']
where
  invite_employment   = '{}'
  or invite_company_size = '{}'
  or invite_seniority = '{}';
