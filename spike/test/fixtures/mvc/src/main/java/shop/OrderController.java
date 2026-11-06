package shop;

@Controller
class OrderController {
  @GetMapping("/orders")
  String list(RedirectAttributes flash) {
    flash.addFlashAttribute("error", "No orders yet.");
    return "orders/list";
  }

  @GetMapping("/")
  String welcome() {
    return "welcome";
  }
}
