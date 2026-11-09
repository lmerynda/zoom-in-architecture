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
		this.cards.save(number);
	}

	void close() {
		this.audit.record("closed");
	}
}
