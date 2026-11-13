-- SECURITY_REVIEW.md S1: names that could be read as HTML.
-- Strips < > " & and backticks from usernames and town names. Idempotent: it only
-- touches rows that still contain one of those characters, so it re-runs on
-- every boot at no cost once the rows are clean. New names are validated in
-- lib/names.js and can no longer contain them.

-- Usernames are UNIQUE, so rows are fixed one at a time: the cleaned name if
-- it is long enough and free, else player<id>_<4 hex>. A clash on either is
-- caught so a boot never fails here.
DO $x$
DECLARE r RECORD; cleaned TEXT;
BEGIN
  FOR r IN SELECT id, username FROM users WHERE username ~ '[<>"&`]' LOOP
    cleaned := regexp_replace(r.username, '[<>"&`]', '', 'g');
    IF length(cleaned) < 3 THEN cleaned := 'player' || r.id; END IF;
    BEGIN
      UPDATE users SET username = cleaned WHERE id = r.id;
    EXCEPTION WHEN unique_violation THEN
      BEGIN
        UPDATE users SET username = 'player' || r.id || '_' || substr(md5(r.username), 1, 4) WHERE id = r.id;
      EXCEPTION WHEN unique_violation THEN
        RAISE WARNING 'name_cleanup: could not rename user %', r.id;
      END;
    END;
  END LOOP;
END $x$;

UPDATE settlements s
   SET name = CASE
     WHEN length(btrim(regexp_replace(s.name, '[<>"&`]', '', 'g'))) >= 2
     THEN left(btrim(regexp_replace(s.name, '[<>"&`]', '', 'g')), 64)
     ELSE 'Camp ' || s.id
   END
 WHERE s.name ~ '[<>"&`]';
