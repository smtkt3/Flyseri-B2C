-- Extend the existing protected servicing workflow; no new role privileges.
ALTER TABLE flight_servicing_cases DROP CONSTRAINT flight_servicing_cases_kind_check;
ALTER TABLE flight_servicing_cases ADD CONSTRAINT flight_servicing_cases_kind_check
  CHECK (kind IN ('ISSUE','CANCEL','VOID','REFUND','EXCHANGE','MODIFY'));
