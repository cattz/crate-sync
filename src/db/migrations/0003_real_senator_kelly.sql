ALTER TABLE `playlists` ADD `is_owned` integer;--> statement-breakpoint
ALTER TABLE `playlists` ADD `owner_id` text;--> statement-breakpoint
ALTER TABLE `playlists` ADD `owner_name` text;