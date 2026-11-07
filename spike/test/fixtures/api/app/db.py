from sqlmodel import Session, create_engine

engine = create_engine("postgresql://db/shop")
session = Session(engine)
