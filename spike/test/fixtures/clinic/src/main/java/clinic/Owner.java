package clinic;

class Owner {

	private Integer id;

	private String lastName;

	private String email;

	Owner(String lastName) {
		this.lastName = lastName;
	}

	Integer getId() {
		return id;
	}

	String getLastName() {
		return lastName;
	}

	String getEmail() {
		return email;
	}
}
