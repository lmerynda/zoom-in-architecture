from app.db import session
from app.models import Item


def get_item(id: int) -> Item:
    return session.get(Item, id)
