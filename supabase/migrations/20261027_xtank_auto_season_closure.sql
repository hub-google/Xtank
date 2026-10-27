CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
SELECT cron.schedule('xtank-close-expired-seasons','15 0 * * *','SELECT xtank.close_expired_seasons();');