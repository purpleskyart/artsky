# Bugfix Requirements Document

## Introduction

The application is experiencing API rate limit errors (HTTP 429) when interacting with the Bluesky/ATProto API due to inefficient request patterns. Multiple components are making redundant, uncached, and sequential API calls for profile data, causing unnecessary load on the API and triggering rate limits during normal usage. This bugfix addresses four critical patterns: uncached profile fetches, sequential profile fetches, missing request deduplication, and lack of profile batching.

The application already has infrastructure in place (RateLimiter, RequestDeduplicator, ResponseCache, getProfileCached function, and getPostsBatch pattern) that is not being consistently utilized across the codebase.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN components like PostActionsMenu or ProfileActionsMenu need profile data THEN the system calls agent.getProfile() directly without caching, causing redundant API requests for the same profile

1.2 WHEN Layout or PostDetailPage need to fetch multiple profiles for session lists THEN the system loops through profiles and fetches them one by one sequentially using publicAgent.getProfile(), creating bursts of sequential requests

1.3 WHEN FeedPage fetches feed display names using Promise.all() with getFeedDisplayName() THEN the system allows duplicate concurrent requests without deduplication

1.4 WHEN multiple profiles need to be fetched THEN the system makes individual API calls for each profile instead of batching them into a single request

1.5 WHEN these inefficient request patterns occur during normal usage THEN the system receives HTTP 429 (Too Many Requests) errors from the API

### Expected Behavior (Correct)

2.1 WHEN components need profile data THEN the system SHALL use getProfileCached() to leverage the existing 10-minute TTL cache with 5-minute stale-while-revalidate

2.2 WHEN multiple profiles need to be fetched THEN the system SHALL batch profile requests into single API calls (similar to the existing getPostsBatch pattern) to minimize API load

2.3 WHEN concurrent requests for the same feed display name occur THEN the system SHALL use requestDeduplicator.dedupe() to ensure only one actual API call is made

2.4 WHEN profile batching is implemented THEN the system SHALL replace sequential profile fetch loops with batched calls that fetch up to 25 profiles per request

2.5 WHEN these optimizations are applied THEN the system SHALL NOT receive HTTP 429 errors during normal usage patterns

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the existing RateLimiter, RequestDeduplicator, and ResponseCache infrastructure is used THEN the system SHALL CONTINUE TO function as designed with per-agent tracking and Retry-After header support

3.2 WHEN getProfileCached() is called THEN the system SHALL CONTINUE TO return cached profile data within the 10-minute TTL window

3.3 WHEN getPostsBatch() is called THEN the system SHALL CONTINUE TO batch post fetches up to 25 per call as currently implemented

3.4 WHEN retryWithBackoff is triggered THEN the system SHALL CONTINUE TO apply exponential backoff for failed requests

3.5 WHEN profile data is successfully fetched and cached THEN the system SHALL CONTINUE TO display correct and up-to-date profile information to users

3.6 WHEN components render profile information THEN the system SHALL CONTINUE TO display the same UI and functionality as before the fix
