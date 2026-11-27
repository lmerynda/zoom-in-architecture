package jobs;

/** Live chat for support. */
@ServerEndpoint("/chat")
public class ChatEndpoint {
    void unused() { new Events().ready(); }
}
