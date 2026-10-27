
CREATE TABLE IF NOT EXISTS xtank.qa_credentials (
 label text PRIMARY KEY,
 email text NOT NULL UNIQUE,
 password text NOT NULL,
 display_name text NOT NULL,
 account_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
 provisioned_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.qa_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.qa_credentials FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON xtank.qa_credentials TO service_role;
CREATE TABLE IF NOT EXISTS xtank.qa_bootstrap (
 bootstrap_id text PRIMARY KEY,
 nonce text NOT NULL UNIQUE,
 consumed_at timestamptz,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE xtank.qa_bootstrap ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON xtank.qa_bootstrap FROM PUBLIC,anon,authenticated;
GRANT SELECT,UPDATE ON xtank.qa_bootstrap TO service_role;
INSERT INTO xtank.qa_credentials(label,email,password,display_name)
VALUES
 ('qa-a','xtank.qa.a@example.com','QA-'||encode(extensions.gen_random_bytes(18),'hex'),'QA-A'),
 ('qa-b','xtank.qa.b@example.com','QA-'||encode(extensions.gen_random_bytes(18),'hex'),'QA-B'),
 ('qa-c','xtank.qa.c@example.com','QA-'||encode(extensions.gen_random_bytes(18),'hex'),'QA-C')
ON CONFLICT(label) DO NOTHING;
INSERT INTO xtank.qa_bootstrap(bootstrap_id,nonce,expires_at)
VALUES ('initial-setup',encode(extensions.gen_random_bytes(32),'hex'),now()+interval '30 minutes')
ON CONFLICT(bootstrap_id) DO NOTHING;
CREATE OR REPLACE FUNCTION public.xtank_qa_claim(p_nonce text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a xtank.qa_bootstrap%ROWTYPE;
BEGIN
 SELECT * INTO a FROM xtank.qa_bootstrap WHERE bootstrap_id='initial-setup' AND nonce=p_nonce AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'QA_TOKEN_INVALID'; END IF;
 RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('label',label,'email',email,'password',password,'display_name',display_name)),'[]'::jsonb) FROM xtank.qa_credentials WHERE account_user_id IS NULL);
END $$;
CREATE OR REPLACE FUNCTION public.xtank_qa_finish(p_nonce text,p_accounts jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a xtank.qa_bootstrap%ROWTYPE; x jsonb;
BEGIN
 SELECT * INTO a FROM xtank.qa_bootstrap WHERE bootstrap_id='initial-setup' AND nonce=p_nonce AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'QA_TOKEN_INVALID'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_accounts) LOOP
  UPDATE xtank.qa_credentials SET account_user_id=(x->>'id')::uuid,provisioned_at=now() WHERE email=x->>'email' AND account_user_id IS NULL;
 END LOOP;
 UPDATE xtank.qa_bootstrap SET consumed_at=now() WHERE bootstrap_id='initial-setup';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.xtank_qa_claim(text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.xtank_qa_finish(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_qa_claim(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.xtank_qa_finish(text,jsonb) TO service_role;
