-- Drop three indexes that the performance advisor flagged as unused.
-- Verified on 2026-04-16: all three had idx_scan = 0 in pg_stat_user_indexes
-- and are not unique / primary, so dropping them frees write cost with no
-- read-path regression. If a future query pattern needs one of them back,
-- re-create it in a fresh migration.
--
-- idx_heal_log_status        — partial btree on heal_log(status) WHERE status <> 'ok'
-- idx_tracks_geometry        — gist on tracks(track); no spatial query uses tracks.track today
-- ingest_stats_source_ts_idx — btree on ingest_stats(source_name, ts DESC); queries filter by ts only

DROP INDEX IF EXISTS public.idx_heal_log_status;
DROP INDEX IF EXISTS public.idx_tracks_geometry;
DROP INDEX IF EXISTS public.ingest_stats_source_ts_idx;
