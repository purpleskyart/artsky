# Bugfix Requirements Document

## Introduction

When users remove a custom feed, all custom feeds disappear from their feed list, leaving only the default "Following" and "What's Hot" feeds. This is a critical data loss issue where removing a single feed inadvertently clears the entire saved feeds list from server preferences. The root cause is that two functions (`removeSavedFeedWithLifecycle` and `removeSavedFeed`) incorrectly set `items: []` when calling `putPreferences`, which clears all saved feeds instead of filtering out just the removed feed.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user removes a custom feed THEN the system clears all saved feeds and only "Following" and "What's Hot" remain visible
1.2 WHEN `removeSavedFeedWithLifecycle` is called in src/lib/bsky.ts (line 2874) THEN the system sets `items: []` which removes all custom feeds instead of filtering out the specific feed
1.3 WHEN `removeSavedFeed` is called in src/lib/bsky-updates.ts (line 561) THEN the system sets `items: []` which removes all custom feeds instead of filtering out the specific feed

### Expected Behavior (Correct)

2.1 WHEN a user removes a custom feed THEN the system SHALL remove only that specific feed while preserving all other custom feeds
2.2 WHEN `removeSavedFeedWithLifecycle` is called THEN the system SHALL filter out the specific feed from the saved feeds list and update preferences with the remaining feeds
2.3 WHEN `removeSavedFeed` is called THEN the system SHALL filter out the specific feed from the saved feeds list and update preferences with the remaining feeds

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user removes a feed that is not in the saved feeds list THEN the system SHALL CONTINUE TO handle the removal gracefully without errors
3.2 WHEN a user has only one custom feed and removes it THEN the system SHALL CONTINUE TO leave only the default feeds visible
3.3 WHEN a user has multiple custom feeds and removes one THEN the system SHALL CONTINUE TO preserve the order and properties of remaining feeds
3.4 WHEN the correct implementation `removeSavedFeedByUri` is used THEN the system SHALL CONTINUE TO properly filter feeds by URI
