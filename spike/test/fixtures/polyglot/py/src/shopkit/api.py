from fastapi import FastAPI
from shopkit import place_order

app = FastAPI()


@app.post("/orders")
def create(order):
    return place_order(order)
