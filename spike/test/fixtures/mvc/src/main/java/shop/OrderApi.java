package shop;

@RestController
@RequestMapping("/api/orders")
class OrderApi {

	private final OrderRepository orders;

	OrderApi(OrderRepository orders) {
		this.orders = orders;
	}

	@GetMapping
	ResponseEntity<Optional<List<Order>>> all() {
		return ResponseEntity.ok(Optional.of(this.orders.findAll()));
	}

	@PostMapping("/{id}/pay")
	ResponseEntity<?> pay() {
		return ResponseEntity.ok().build();
	}
}
