ALTER TABLE `playlists` ADD `source` text;--> statement-breakpoint
UPDATE `playlists` SET `source` = CASE WHEN `spotify_id` IS NOT NULL THEN 'spotify' ELSE 'local' END WHERE `source` IS NULL;