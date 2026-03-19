CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer DEFAULT 0 NOT NULL,
	`payload` text,
	`result` text,
	`error` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`run_after` integer,
	`parent_job_id` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
