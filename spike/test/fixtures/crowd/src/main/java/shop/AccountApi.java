package shop;

@RestController
@RequestMapping("/account")
class AccountApi {

	private final AccountService accounts;

	AccountApi(AccountService accounts) {
		this.accounts = accounts;
	}

	@GetMapping
	ResponseEntity<?> show() { return ResponseEntity.ok().build(); }

	@GetMapping("/details")
	ResponseEntity<?> details() { return ResponseEntity.ok().build(); }

	@PostMapping("/close")
	ResponseEntity<?> close() { this.accounts.close(); return ResponseEntity.ok().build(); }

	@PostMapping("/add-card")
	ResponseEntity<?> addCard() { this.accounts.addCard("4242"); return ResponseEntity.ok().build(); }

	@PostMapping("/remove-card")
	ResponseEntity<?> removeCard() { return ResponseEntity.ok().build(); }

	@PostMapping("/add-address")
	ResponseEntity<?> addAddress() { return ResponseEntity.ok().build(); }

	@PostMapping("/remove-address")
	ResponseEntity<?> removeAddress() { return ResponseEntity.ok().build(); }

	@GetMapping("/address-book")
	ResponseEntity<?> addressBook() { return ResponseEntity.ok().build(); }

	@PostMapping("/redeem-loyalty-points")
	ResponseEntity<?> redeem() { return ResponseEntity.ok().build(); }

	@GetMapping("/loyalty-points-balance")
	ResponseEntity<?> balance() { return ResponseEntity.ok().build(); }

	@GetMapping("/messages")
	ResponseEntity<?> messages() { return ResponseEntity.ok().build(); }

	@GetMapping("/messages/count")
	ResponseEntity<?> unread() { return ResponseEntity.ok().build(); }

	@PostMapping("/messages/{id}/read")
	ResponseEntity<?> read() { return ResponseEntity.ok().build(); }
}
