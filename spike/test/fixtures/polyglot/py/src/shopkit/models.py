from sqlalchemy import create_engine

engine = create_engine("postgresql://db/shop")


class Order:
    pass
