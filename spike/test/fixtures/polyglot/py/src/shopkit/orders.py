"""Placing orders."""
import requests
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .models import Order


def place_order(order: "Order"):
    return requests.post("https://pay.example.com/charge", json=order)
