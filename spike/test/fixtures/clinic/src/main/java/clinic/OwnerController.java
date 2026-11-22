package clinic;

// Modelled on Spring PetClinic's OwnerController.
@Controller
class OwnerController {

	private static final String VIEWS_OWNER_FORM = "owners/createOrUpdateOwnerForm";

	private final OwnerRepository owners;

	private final ClinicService clinic;

	private final Mailer mailer;

	private final PetRepository pets;

	OwnerController(OwnerRepository owners, ClinicService clinic, Mailer mailer, PetRepository pets) {
		this.owners = owners;
		this.clinic = clinic;
		this.mailer = mailer;
		this.pets = pets;
	}

	@GetMapping("/owners/find")
	public String initFindForm() {
		// Only a view name and this comment mention owners: owners.findAll() does not run here.
		return "owners/findOwners";
	}

	@GetMapping("/owners")
	public String processFindForm(int page, Owner owner, Model model) {
		Page<Owner> results = findPaginated(page, owner.getLastName());
		if (page < 1) {
			return "redirect:/owners";
		}
		if (results.isEmpty()) {
			return "owners/findOwners";
		}
		if (results.getTotalElements() == 1) {
			owner = results.iterator().next();
			return "redirect:/owners/" + owner.getId();
		}
		return addPaginationModel(page, model, results);
	}

	private String addPaginationModel(int page, Model model, Page<Owner> paginated) {
		model.addAttribute("listOwners", paginated.getContent());
		return "owners/ownersList";
	}

	private Page<Owner> findPaginated(int page, String lastName) {
		return owners.findByLastName(lastName, PageRequest.of(page - 1, 5));
	}

	@PostMapping("/owners/new")
	public String processCreationForm(@Valid OwnerForm form) {
		Owner owner = this.clinic.register(form.getLastName());
		this.mailer.welcome(owner);
		return "redirect:/owners/" + owner.getId();
	}

	@PostMapping("/owners/greet")
	public String greet(Owner owner) {
		this.mailer.welcome(owner);
		this.clinic.register(owner.getLastName());
		return "redirect:/owners";
	}

	@GetMapping("/owners/{ownerId}/edit")
	public String initUpdateOwnerForm() {
		return VIEWS_OWNER_FORM;
	}

	@PostMapping("/owners/{ownerId}/forget")
	public String forget(int ownerId) {
		this.clinic.forget(ownerId);
		return "redirect:/owners";
	}

	@GetMapping("/owners/{ownerId}/pets")
	public String pets(int ownerId, Model model) {
		model.addAttribute("pets", this.pets.findPets(ownerId));
		return "owners/ownersList";
	}
}
