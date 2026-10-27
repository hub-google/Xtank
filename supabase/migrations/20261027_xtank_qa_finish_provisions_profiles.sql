
CREATE OR REPLACE FUNCTION public.xtank_qa_finish(p_nonce text,p_accounts jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a xtank.qa_bootstrap%ROWTYPE; x jsonb; user_id uuid; email_address text; nick text;
BEGIN
 SELECT * INTO a FROM xtank.qa_bootstrap WHERE bootstrap_id='initial-setup' AND nonce=p_nonce AND consumed_at IS NULL AND expires_at>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'QA_TOKEN_INVALID'; END IF;
 IF jsonb_array_length(p_accounts)<>3 THEN RAISE EXCEPTION 'QA_REQUIRES_THREE_PLAYERS'; END IF;
 FOR x IN SELECT value FROM jsonb_array_elements(p_accounts) LOOP
  user_id:=(x->>'id')::uuid;
  email_address:=x->>'email';
  SELECT display_name INTO nick FROM xtank.qa_credentials WHERE email=email_address;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=user_id AND email=email_address) THEN RAISE EXCEPTION 'QA_USER_UNVERIFIED'; END IF;
  UPDATE xtank.qa_credentials SET account_user_id=user_id,provisioned_at=now() WHERE email=email_address;
  PERFORM xtank.provision_player(user_id,nick);
 END LOOP;
 UPDATE xtank.qa_bootstrap SET consumed_at=now() WHERE bootstrap_id='initial-setup';
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.xtank_qa_finish(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.xtank_qa_finish(text,jsonb) TO service_role;