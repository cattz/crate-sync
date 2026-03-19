ALTER TABLE `playlists` ADD `tags` text;--> statement-breakpoint
ALTER TABLE `playlists` ADD `notes` text;--> statement-breakpoint
ALTER TABLE `playlists` ADD `pinned` integer DEFAULT 0;