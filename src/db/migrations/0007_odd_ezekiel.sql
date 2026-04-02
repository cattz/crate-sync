ALTER TABLE `downloads` ADD `wishlist_retries` integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE `downloads` ADD `next_retry_at` integer;