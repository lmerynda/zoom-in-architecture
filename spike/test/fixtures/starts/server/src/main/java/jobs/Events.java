package jobs;

/** What the jobs server hears from others. */
public class Events {
    @KafkaListener(topics = "orders")
    public void onOrder(String order) {
        new Cleanup().sweep();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void ready() {}
}
