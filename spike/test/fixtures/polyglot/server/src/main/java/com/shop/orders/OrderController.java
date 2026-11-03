package com.shop.orders;

import com.shop.orders.model.Order;
import java.util.List;

/** Serves orders over HTTP. */
@RestController
public class OrderController {
    private final OrderRepository repository;

    @GetMapping("/api/orders")
    public List<Order> all() { return repository.findAll(); }
}
