package com.example.myapp;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Column;

@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;

    @Column(name = "email", nullable = false)
    private String email;

    @Column(name = "name")
    private String name;

    public Long getId() { return id; }
    public String getEmail() { return email; }
    public String getName() { return name; }
}
