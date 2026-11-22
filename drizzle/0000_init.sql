CREATE TABLE `captures` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seeker_id` text NOT NULL,
	`hider_id` text NOT NULL,
	`method` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	`resolved_by` text,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `captures_match_idx` ON `captures` (`match_id`);--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `group_members_user_idx` ON `group_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`icon` text NOT NULL,
	`owner_id` text NOT NULL,
	`join_code` text NOT NULL,
	`invite_token` text NOT NULL,
	`password_hash` text,
	`max_members` integer DEFAULT 15 NOT NULL,
	`settings_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_join_code_unique` ON `groups` (`join_code`);--> statement-breakpoint
CREATE UNIQUE INDEX `groups_invite_token_unique` ON `groups` (`invite_token`);--> statement-breakpoint
CREATE TABLE `match_events` (
	`id` text PRIMARY KEY NOT NULL,
	`match_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`actor_id` text,
	`payload_json` text NOT NULL,
	`audience` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `match_events_seq_idx` ON `match_events` (`match_id`,`seq`);--> statement-breakpoint
CREATE TABLE `match_players` (
	`match_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text,
	`team` text,
	`status` text NOT NULL,
	`ready` integer DEFAULT false NOT NULL,
	`consent_hash` text,
	`joined_at` integer NOT NULL,
	`left_at` integer,
	`stats_json` text,
	`is_bot` integer DEFAULT false NOT NULL,
	PRIMARY KEY(`match_id`, `user_id`),
	FOREIGN KEY (`match_id`) REFERENCES `matches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `match_players_user_idx` ON `match_players` (`user_id`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`host_id` text NOT NULL,
	`settings_json` text NOT NULL,
	`zones_json` text NOT NULL,
	`settings_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`ended_at` integer,
	`result_json` text,
	`snapshot_json` text,
	`version` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `matches_group_state_idx` ON `matches` (`group_id`,`state`);--> statement-breakpoint
CREATE TABLE `presets` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`mode` text NOT NULL,
	`data_json` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `presets_group_idx` ON `presets` (`group_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`username` text,
	`password_hash` text,
	`avatar_color` text NOT NULL,
	`avatar_emoji` text NOT NULL,
	`created_at` integer NOT NULL,
	`stats_json` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);