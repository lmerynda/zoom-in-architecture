package shop;

@Service
class AccountService {

	private final CardRepository cards;
	private final AuditRepository audit;

	AccountService(CardRepository cards, AuditRepository audit) {
		this.cards = cards;
		this.audit = audit;
	}

	void addCard(String number) {
		if (this.cards.findCard(number)) return;
		this.cards.save(number);
	}

	// Same name as the repository's method: addCard calling cards.findCard does not run this.
	boolean findCard(String number) {
		return this.audit.seen(number);
	}

	void close() {
		this.audit.record("closed");
	}
}
