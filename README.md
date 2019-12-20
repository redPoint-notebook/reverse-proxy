![](redpoint-brand-logo_horizontal-on_light.png)

# Dispatch Server for RedPoint Notebooks

## Primary Responsibilities :

### Reverse Proxy

As a reverse proxy, the dispatch server stands between incoming client requests and the Docker containers they’re connected with. By mapping a user’s unique session URL with the IP, and port of a running container, the dispatch server guards the exact location of the user’s container.

### Database Middleware

The dispatch server also acts as an intermediary with MongoDB. The decoupling of client-database interaction allows greater database security since any database queries are performed using our prescribed functions. Additionally, abstracting direct database interaction away from the client makes the app easier to maintain, and scale.

Incoming webhook traffic is enqueued using the RedisSMQ library to provide database query rate limiting. A background process dequeues webhook data from the Redis queue and stores it in the database.

### Session Manager

When a user visits our homepage, the dispatch server creates a new session with a unique subdomain for their session’s URL. Session data is decoupled from the dispatch server, and stored in Redis allowing for greater session persistence. Delete requests for an inactive, or closed session are handled by the dispatch server by stopping the session’s Docker container, and deleting the session object in Redis.
