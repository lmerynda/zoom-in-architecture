package clinic;

// Reaches no store, but does work of its own: a step of the request, not a type it names.
@Component
class Mailer {

	void welcome(Owner owner) {
		String body = "Welcome, " + owner.getLastName();
		send(owner.getEmail(), body);
	}

	private void send(String to, String body) {
		System.out.println(to + ": " + body);
	}
}
