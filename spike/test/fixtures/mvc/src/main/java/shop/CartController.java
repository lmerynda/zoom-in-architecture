package shop;

@Controller
@RequestMapping("/cart")
class CartController {

	private static final String VIEW = "orders/list";

	private final OrderRepository orders;

	CartController(OrderRepository orders) {
		this.orders = orders;
	}

	@GetMapping({ "/items" })
	String items() {
		this.orders.findAll();
		return VIEW;
	}

	@PostMapping
	String add() {
		return "redirect:/cart/items";
	}
}
