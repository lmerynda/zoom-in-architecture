package jobs;

/** Sweeps expired carts. */
public class Cleanup {
    // @Scheduled(fixedRate = 1000) is the old rate, kept in a comment.
    @Scheduled(fixedRate = 5000)
    @Transactional
    public void sweep() {
    }

    @Scheduled(cron = "0 0 * * * *")
    void hourly() {}
}
