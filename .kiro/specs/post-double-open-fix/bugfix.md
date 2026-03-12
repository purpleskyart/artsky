# Bugfix Requirements Document

## Introduction

When clicking a post on the homepage, the post opens in a modal, then the page refreshes and the post opens again. This double-open behavior is caused by the Link component in PostCard.tsx navigating to `/post/{uri}` while simultaneously the modal opens from the query parameter. Profile clicks work correctly because they don't have this dual navigation issue. The fix is to change the Link's `to` attribute from `/post/{encodeURIComponent(post.uri)}` to `#` to prevent the route navigation, allowing only the modal to open.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user clicks a post card on the homepage THEN the post opens in a modal and the page simultaneously navigates to the `/post/:uri` route, causing the post to display twice
1.2 WHEN the page navigates to `/post/:uri` THEN PostDetailPage renders as a full page view while the modal is also open, creating a conflicting display state

### Expected Behavior (Correct)

2.1 WHEN a user clicks a post card on the homepage THEN the post SHALL open only in a modal without triggering a route navigation
2.2 WHEN a user clicks a post card THEN the page SHALL NOT navigate to `/post/:uri` and only the modal SHALL display the post

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user clicks a profile link THEN the profile SHALL CONTINUE TO open correctly without double-opening
3.2 WHEN a user interacts with other navigation elements THEN they SHALL CONTINUE TO function as expected
3.3 WHEN a post modal is open THEN the user SHALL CONTINUE TO be able to close it normally
