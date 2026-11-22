package clinic;

// forget() is inherited from BaseService (not in this repo): a caller of it runs none of the code below.
@Service
class ClinicService extends BaseService {

	private final OwnerRepository owners;

	private final AuditRepository audit;

	ClinicService(OwnerRepository owners, AuditRepository audit) {
		this.owners = owners;
		this.audit = audit;
	}

	Owner register(String lastName) {
		Owner owner = new Owner(lastName);
		return this.owners.save(owner);
	}

	void purge() {
		this.audit.record("purged");
	}
}
