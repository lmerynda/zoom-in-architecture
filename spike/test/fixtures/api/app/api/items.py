from fastapi import APIRouter

from app import crud
from app.models import Item

router = APIRouter(prefix="/items")


@router.get("/{id}", response_model=Item)
def read_item(id: int) -> Item:
    return crud.get_item(id)


@router.get("/health")
def health() -> bool:
    return True
