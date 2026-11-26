package jobs;

/** Starts the jobs server. */
public class JobsApplication {
    public static void main(String[] args) {
        new Cleanup().sweep();
    }
}
