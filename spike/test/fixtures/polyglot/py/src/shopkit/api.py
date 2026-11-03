from fastapi import FastAPI
from shopkit import place_order

app = FastAPI()


@app.post("/orders")
def create(order, session):
    session.add(order)
    return place_order(order)


@app.get(
    "/orders/{order_id}"
)
def read(order_id):
    return order_id
