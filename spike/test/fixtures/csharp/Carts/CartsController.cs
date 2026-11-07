namespace Shop.Carts;

public class CartsController
{
    public void Post(System.Collections.Generic.List<object> items)
    {
        var create = new Create();
        items.Add(create);
    }
}
